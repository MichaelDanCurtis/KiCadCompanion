/** Attempt every owned cleanup and wait for all results, including failures.
 * Step names are host-owned labels; raw failure details need not reach the UI.
 * Repeated signals share the same shutdown and finalization promise.
 */
export function createShutdown({steps, finish = result => result}) {
  let closing;
  return () => closing ||= Promise.allSettled(steps.map(step => Promise.resolve().then(step.close)))
    .then(results => finish({ok: results.every(result => result.status === 'fulfilled'),
      failures: results.flatMap((result, index) => result.status === 'rejected' ?
        [{name: steps[index].name, error: result.reason}] : []),
    }));
}

export function closeHttpServer(server) {
  return new Promise((resolve, reject) => {
    // Stop accepting before dropping established requests/SSE connections.
    // Dropping them also triggers the product route's request-abort cleanup.
    try {server.close(error => error ? reject(error) : resolve());}
    catch (error) {reject(error);}
    finally {try {server.closeAllConnections();} catch (error) {reject(error);}}
  });
}
