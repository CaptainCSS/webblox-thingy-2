import { createServer } from "node:http";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { logging, server as wisp } from "@mercuryworkshop/wisp-js/server";
import { BLOX_PREFIX, createBloxHandler } from "./server/blox";

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || "127.0.0.1";

const launcherFile = Bun.file(
  resolve(import.meta.dir, "singlefile.html")
);

// Restrict Wisp to Roblox-related domains and HTTPS.
wisp.options.hostname_whitelist = [
  /(^|\.)(roblox\.com|rbxcdn\.com|robloxlabs\.com)$/i
];

wisp.options.port_whitelist = [443];

logging.set_level(logging.WARN);

const handleBlox = createBloxHandler({
  host: resolve(import.meta.dir, "webblox"),
  engine: resolve(import.meta.dir, "vendor", "webblox", "engine"),
  epoxy: Bun.resolveSync(
    "@mercuryworkshop/epoxy-transport",
    import.meta.dir
  ),
});

const isolatedHeaders = {
  "Content-Type": "text/html; charset=utf-8",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "no-cache"
};

const server = createServer(async (req, res) => {
  const url = new URL(
    req.url ?? "/",
    `http://${req.headers.host ?? "localhost"}`
  );

  let response: Response;

  // Serve the single-file launcher.
  if (
    url.pathname === "/" ||
    url.pathname === "/singlefile.html"
  ) {
    if (await launcherFile.exists()) {
      response = new Response(
        req.method === "HEAD" ? null : launcherFile,
        { headers: isolatedHeaders }
      );
    } else {
      response = new Response(
        "singlefile.html not found",
        { status: 404, headers: isolatedHeaders }
      );
    }

  // Serve the original Roblox client.
  } else if (url.pathname.startsWith(BLOX_PREFIX)) {
    const headers = new Headers();

    for (const [name, value] of Object.entries(req.headers)) {
      if (typeof value === "string") {
        headers.set(name, value);
      }
    }

    const abort = new AbortController();

    res.on("close", () => abort.abort());

    response = await handleBlox(
      new Request(url, {
        method: req.method,
        headers,
        signal: abort.signal
      }),
      url.pathname
    );

  } else {
    response = new Response("Not found", { status: 404 });
  }

  res.writeHead(
    response.status,
    Object.fromEntries(response.headers)
  );

  if (response.body) {
    Readable.fromWeb(response.body as never).pipe(res);
  } else {
    res.end();
  }
});

// WebSocket connection for Wisp.
server.on("upgrade", (req, socket, head) => {
  if (req.url?.startsWith("/wisp/")) {
    wisp.routeRequest(req, socket, head);
  } else {
    socket.destroy();
  }
});

server.listen(PORT, HOST, () => {
  console.log(
    `[webblox] http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}/`
  );
});