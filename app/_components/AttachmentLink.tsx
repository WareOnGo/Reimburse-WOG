"use client";

type Props = {
  id: string;
  name: string;
  sizeLabel: string;
  kind: "IMAGE" | "DOCUMENT";
  previewUrl: string;
};

export default function AttachmentLink({ name, sizeLabel, kind, previewUrl }: Props) {
  function openFullscreen() {
    window.open(previewUrl, "_blank", "noopener,noreferrer");
  }
  const keyboard = {
    role: "button", tabIndex: 0, "aria-label": `Open attachment ${name}`,
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openFullscreen(); }
    },
  };

  if (kind === "IMAGE") {
    return (
      <figure
        {...keyboard}
        className="media-tile"
        onClick={openFullscreen}
        style={{ cursor: "pointer" }}
        title="Click to open"
      >
        <div className="media-tile-frame">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt={name} loading="lazy" />
        </div>
        <figcaption>
          <span>{name}</span>
          <span className="size">{sizeLabel}</span>
        </figcaption>
      </figure>
    );
  }

  // DOCUMENT (PDF in practice)
  return (
    <figure
      {...keyboard}
      className="media-tile"
      onClick={openFullscreen}
      style={{ cursor: "pointer" }}
      title="Click to open"
    >
      <div className="media-tile-frame pdf-frame">
        <iframe
          tabIndex={-1}
          src={`${previewUrl}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
          title={name}
          loading="lazy"
        />
        <div className="pdf-overlay" aria-hidden="true">
          <span className="pdf-tag">PDF</span>
        </div>
      </div>
      <figcaption>
        <span>📄 {name}</span>
        <span className="size">{sizeLabel}</span>
      </figcaption>
    </figure>
  );
}
