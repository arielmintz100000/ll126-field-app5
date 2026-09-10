"use client";

import { useEffect, useRef } from "react";

/**
 * Camera / gallery capture with an upload queue.
 * Anything that fails (dead rooftop signal) stays queued and retries the
 * moment the browser reports it is back online, or when the inspector submits.
 */
export default function PhotoCapture({
  label = "Capture photo",
  accept = "image/*",
  capture = "environment",
  multiple = true,
  items,
  onAdd,
  onRemove,
}) {
  const inputRef = useRef(null);

  useEffect(() => {
    return () => {
      items.forEach((item) => item.preview && URL.revokeObjectURL(item.preview));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = (event) => {
    const files = Array.from(event.target.files || []);
    if (files.length) onAdd(files);
    event.target.value = "";
  };

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        capture={capture}
        multiple={multiple}
        onChange={pick}
        style={{ display: "none" }}
      />
      <button type="button" className="capture" onClick={() => inputRef.current?.click()}>
        <span aria-hidden="true">▣</span>
        {label}
      </button>

      {items.length > 0 && (
        <div className="thumbs">
          {items.map((item) => (
            <div className="thumb" key={item.id}>
              {item.preview && item.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.preview} alt={item.name} />
              ) : (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    height: "100%",
                    fontSize: 26,
                  }}
                >
                  ▶
                </div>
              )}
              <button
                type="button"
                className="thumb-x"
                onClick={() => onRemove(item.id)}
                aria-label={`Remove ${item.name}`}
              >
                ×
              </button>
              <div className="thumb-state" data-s={item.state}>
                {item.state}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
