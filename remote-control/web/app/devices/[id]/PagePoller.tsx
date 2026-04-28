"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function PagePoller() {
  const router = useRouter();

  useEffect(() => {
    const interval = setInterval(() => {
      const paused =
        typeof window !== "undefined" &&
        window.localStorage.getItem("setulinkPausePolling") === "1";

      if (!paused) {
        router.refresh();
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [router]);

  return null;
}
