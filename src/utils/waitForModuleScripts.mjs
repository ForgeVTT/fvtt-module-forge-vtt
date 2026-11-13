/**
 * Waits for every module script (`<script type="module" src="...">`) on the page to finish evaluating.
 *
 * The browser fires `DOMContentLoaded` once module scripts have *started* evaluating, not once they have finished.
 * A module with a top-level `await` can therefore still be running when Foundry starts initializing the game.
 * Dynamically importing a URL that is already in the module map does not fetch or run it again: it returns a promise
 * for that module's evaluation, which lets us wait for it to complete.
 * @param {number} [timeout] Maximum time to wait, in milliseconds (10 seconds by default)
 * @returns {Promise<{elapsed: number, pending: string[]}>} Amount of time spent waiting and a list of module script URLs that are still pending evaluation after the timeout
 */
export async function waitForModuleScripts(timeout = 10000) {
  const start = performance.now();
  const pending = new Set();
  const evaluations = Array.from(document.querySelectorAll('script[type="module"][src]'), (script) => {
    const url = script.src;
    pending.add(url);
    return (
      import(/* @vite-ignore */ url)
        // Fetch and evaluation errors were already reported by the browser when the script tag ran
        .catch(() => null)
        .finally(() => pending.delete(url))
    );
  });

  let timer;
  await Promise.race([
    Promise.all(evaluations),
    new Promise((resolve) => {
      timer = setTimeout(resolve, timeout);
    }),
  ]);
  clearTimeout(timer);

  return { elapsed: Math.round(performance.now() - start), pending: [...pending] };
}
