import { DEFAULT_BAR, runManganese } from "@domicile-desktop/manganese";
import { useEffect, useState } from "react";
import "./tokyo.css";

const Tokyo = () => {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  const time = now.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Tokyo",
  });
  return <span className="tokyo">Tokyo {time}</span>;
};

export const Shell = runManganese({
  bar: {
    ...DEFAULT_BAR,
    center: [...DEFAULT_BAR.center, <Tokyo key="tokyo" />],
  },
});
