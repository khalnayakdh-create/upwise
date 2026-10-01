/** Admin and API hosts have nothing to index; also stops "no route" errors in the logs. */
export const loader = () =>
  new Response("User-agent: *\nDisallow: /\n", {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=86400" },
  });
