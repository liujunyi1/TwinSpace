"use client";

import { useMemo, useState } from "react";
import { LocateFixed, MapPin } from "lucide-react";

const CITIES = [
  { name: "北京", lat: 39.9042, lng: 116.4074 },
  { name: "上海", lat: 31.2304, lng: 121.4737 },
  { name: "广州", lat: 23.1291, lng: 113.2644 },
  { name: "深圳", lat: 22.5431, lng: 114.0579 },
  { name: "杭州", lat: 30.2741, lng: 120.1551 },
  { name: "南京", lat: 32.0603, lng: 118.7969 },
  { name: "苏州", lat: 31.2989, lng: 120.5853 },
  { name: "成都", lat: 30.5728, lng: 104.0668 },
  { name: "重庆", lat: 29.563, lng: 106.5516 },
  { name: "武汉", lat: 30.5928, lng: 114.3055 },
  { name: "西安", lat: 34.3416, lng: 108.9398 },
  { name: "天津", lat: 39.3434, lng: 117.3616 },
  { name: "青岛", lat: 36.0671, lng: 120.3826 },
  { name: "厦门", lat: 24.4798, lng: 118.0894 },
  { name: "长沙", lat: 28.2282, lng: 112.9388 }
];

function nearestCity(latitude: number, longitude: number) {
  return CITIES.reduce((best, city) => {
    const distance = Math.hypot(latitude - city.lat, longitude - city.lng);
    return distance < best.distance ? { name: city.name, distance } : best;
  }, { name: CITIES[0].name, distance: Number.POSITIVE_INFINITY }).name;
}

export function CityLocator({ defaultValue = "" }: { defaultValue?: string }) {
  const [city, setCity] = useState(defaultValue);
  const [status, setStatus] = useState("");
  const suggestions = useMemo(() => CITIES.slice(0, 8), []);

  function locate() {
    if (!navigator.geolocation) {
      setStatus("当前浏览器不支持定位");
      return;
    }
    setStatus("定位中");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCity(nearestCity(position.coords.latitude, position.coords.longitude));
        setStatus("已定位到城市级别");
      },
      () => setStatus("定位失败，可手动填写"),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 10 * 60 * 1000 }
    );
  }

  return (
    <div className="rounded-[24px] bg-surface p-3">
      <label className="flex items-center gap-2 rounded-full bg-white px-4 py-3 text-sm text-muted">
        <MapPin className="h-4 w-4" aria-hidden />
        <input
          name="location"
          value={city}
          onChange={(event) => setCity(event.target.value)}
          className="min-w-0 flex-1 bg-transparent outline-none"
          placeholder="城市，例如 上海"
          aria-label="城市定位"
          maxLength={40}
        />
        <button
          type="button"
          onClick={locate}
          className="inline-flex items-center gap-1 rounded-full bg-ink px-3 py-1.5 text-xs font-semibold text-white"
        >
          <LocateFixed className="h-3.5 w-3.5" aria-hidden />
          定位
        </button>
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        {suggestions.map((item) => (
          <button
            key={item.name}
            type="button"
            onClick={() => {
              setCity(item.name);
              setStatus("");
            }}
            className="chip"
          >
            {item.name}
          </button>
        ))}
      </div>
      {status ? <p className="mt-2 px-1 text-xs text-muted">{status}</p> : null}
    </div>
  );
}
