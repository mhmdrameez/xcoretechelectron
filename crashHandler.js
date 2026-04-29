let crashSending = false;

function trimError(input) {
  return String(input || "").replace(/\s+/g, " ").trim().slice(0, 120);
}

function installCrashHandler(sendEvent) {
  if (typeof sendEvent !== "function") return;

  function capture(errLike) {
    if (crashSending) return;
    crashSending = true;
    try {
      const msg =
        (errLike && errLike.message) || (typeof errLike === "string" ? errLike : "unknown crash");
      sendEvent("crash", { error: trimError(msg) }, { immediate: true });
    } catch (_) {
      // never throw from crash path
    }
    setTimeout(() => {
      crashSending = false;
    }, 2500);
  }

  process.on("uncaughtException", (err) => capture(err));
  process.on("unhandledRejection", (reason) => capture(reason));
}

module.exports = { installCrashHandler };
