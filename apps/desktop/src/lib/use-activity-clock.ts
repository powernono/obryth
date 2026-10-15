import { useEffect, useState } from "react";
import { dateKey, deviceTimeZone } from "./activity";

function readClock(now = new Date()) {
  const zone = deviceTimeZone();
  return { today: dateKey(now, zone), zone };
}

export function useActivityClock() {
  const [clock, setClock] = useState(readClock);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      clearTimeout(timer);
      const now = new Date();
      const next = readClock(now);
      setClock((old) =>
        old.today === next.today && old.zone === next.zone ? old : next,
      );
      const midnight = new Date(now);
      midnight.setHours(24, 0, 0, 0);
      // Also detect system timezone changes; the last tick lands at local midnight.
      timer = setTimeout(
        update,
        Math.min(30_000, midnight.getTime() - now.getTime() + 10),
      );
    };
    const resume = () => {
      if (document.visibilityState === "visible") update();
    };
    update();
    window.addEventListener("focus", update);
    window.addEventListener("pageshow", update);
    document.addEventListener("visibilitychange", resume);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", update);
      window.removeEventListener("pageshow", update);
      document.removeEventListener("visibilitychange", resume);
    };
  }, []);
  return clock;
}
