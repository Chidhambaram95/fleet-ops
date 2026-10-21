export type QuoteImageInput = {
  company: string;
  phone: string;
  quoteNo: string;
  customer: string;
  trip: string;
  when: string;
  people: string;
  total: string;
  advance: string;
  includes: string[];
  validTill: string;
};

// The app's colours.
const BRAND = "#3a3fb8";
const BRAND_DARK = "#2a2e8c";
const BRAND_SOFT = "#e6e7fa";
const BRAND_PALE = "#d9daf6";
const CANVAS = "#f3f4fb";
const INK = "#1a1b2e";
const MUTED = "#5b5e7a";
const GREEN = "#1e6b45";
const FONT = '"Plus Jakarta Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * A small, simple quote picture for WhatsApp: the company name on top, then the
 * trip, the price and what is included. Drawn on a canvas, so it needs no server.
 */
export async function drawQuoteImage(input: QuoteImageInput): Promise<Blob> {
  const W = 900;
  const PAD = 48;
  const inner = W - PAD * 2;
  const canvas = document.createElement("canvas");
  const probe = canvas.getContext("2d");
  if (!probe) throw new Error("Could not draw the quote on this device.");
  try {
    await document.fonts?.load(`800 40px ${FONT}`);
  } catch {
    // The system font is fine.
  }

  // First pass measures, second draws, so the picture is exactly as tall as it needs to be.
  const run = (draw: boolean) => {
    const ctx = canvas.getContext("2d")!;
    let y = 0;
    const text = (value: string, x: number, baseline: number, font: string, color: string, align: CanvasTextAlign = "left") => {
      if (!draw) return;
      ctx.font = font;
      ctx.fillStyle = color;
      ctx.textAlign = align;
      ctx.fillText(value, x, baseline);
    };

    // Header: the company name is the biggest thing on the page.
    ctx.font = `800 60px ${FONT}`;
    const nameLines = wrap(ctx, input.company, inner).slice(0, 2);
    const headerH = 70 + nameLines.length * 70 + 70;
    if (draw) {
      ctx.fillStyle = BRAND;
      ctx.fillRect(0, 0, W, headerH);
    }
    y = 40;
    text("TOUR QUOTE · " + input.quoteNo, PAD, y + 20, `700 24px ${FONT}`, BRAND_PALE);
    y += 40;
    for (const line of nameLines) {
      y += 70;
      text(line, PAD, y, `800 60px ${FONT}`, "#ffffff");
    }
    y = headerH + 40;

    const row = (label: string, value: string) => {
      ctx.font = `700 30px ${FONT}`;
      const lines = wrap(ctx, value, inner);
      text(label, PAD, y + 22, `600 22px ${FONT}`, MUTED);
      y += 28;
      for (const line of lines) {
        y += 40;
        text(line, PAD, y, `700 30px ${FONT}`, INK);
      }
      y += 26;
    };
    row("Quote for", input.customer);
    row("Trip", input.trip);
    row("When", input.when);
    if (input.people) row("People", input.people);

    // Price panel.
    y += 6;
    const panelH = input.advance ? 250 : 190;
    if (draw) {
      ctx.fillStyle = BRAND_SOFT;
      rounded(ctx, PAD, y, inner, panelH, 28);
      ctx.fill();
    }
    text("Total price", PAD + 32, y + 52, `600 26px ${FONT}`, MUTED);
    text(input.total, PAD + 32, y + 136, `800 84px ${FONT}`, BRAND_DARK);
    if (input.advance) {
      text(`Pay ${input.advance} now to book your bus`, PAD + 32, y + 202, `700 28px ${FONT}`, GREEN);
    }
    y += panelH + 40;

    if (input.includes.length) {
      text("Price includes", PAD, y + 22, `600 22px ${FONT}`, MUTED);
      y += 36;
      ctx.font = `600 28px ${FONT}`;
      for (const item of input.includes.slice(0, 8)) {
        const lines = wrap(ctx, item, inner - 48);
        text("✓", PAD, y + 36, `800 28px ${FONT}`, GREEN);
        for (const line of lines) {
          y += 40;
          text(line, PAD + 44, y, `600 28px ${FONT}`, INK);
        }
        y += 8;
      }
      y += 24;
    }

    if (input.validTill) {
      const label = `Price valid till ${input.validTill}`;
      ctx.font = `700 24px ${FONT}`;
      const w = ctx.measureText(label).width + 48;
      if (draw) {
        ctx.fillStyle = "#fff5e5";
        rounded(ctx, PAD, y, w, 52, 26);
        ctx.fill();
      }
      text(label, PAD + 24, y + 35, `700 24px ${FONT}`, "#8a5300");
      y += 52 + 36;
    }

    // Footer.
    const footerH = input.phone ? 130 : 70;
    if (draw) {
      ctx.fillStyle = BRAND;
      ctx.fillRect(0, y, W, footerH);
    }
    if (input.phone) {
      text("To book, call or WhatsApp", W / 2, y + 48, `600 24px ${FONT}`, BRAND_PALE, "center");
      text(input.phone, W / 2, y + 100, `800 40px ${FONT}`, "#ffffff", "center");
    } else {
      text(input.company, W / 2, y + 44, `700 26px ${FONT}`, "#ffffff", "center");
    }
    return y + footerH;
  };

  const height = run(false);
  canvas.width = W;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = CANVAS;
  ctx.fillRect(0, 0, W, height);
  run(true);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not make the quote picture."))), "image/png"),
  );
}
