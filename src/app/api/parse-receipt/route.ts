import { google } from "@ai-sdk/google";
import { generateText, Output } from "ai";
import { NextResponse } from "next/server";
import { receiptSchema } from "@domain/operations/receipt";

const MAX_IMAGE_CHARS = 1_500_000;

export async function POST(request: Request) {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return NextResponse.json(
      { error: "Add GOOGLE_GENERATIVE_AI_API_KEY to .env.local." },
      { status: 500 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send a receipt photo." }, { status: 400 });
  }

  const image = readImage(body);
  if (!image) {
    return NextResponse.json({ error: "Send a receipt photo." }, { status: 400 });
  }
  if (image.base64.length > MAX_IMAGE_CHARS) {
    return NextResponse.json(
      { error: "That photo is too large. Try again closer to the receipt." },
      { status: 413 },
    );
  }

  try {
    const result = await generateText({
      model: google("gemini-3.8-flash"),
      output: Output.object({
        schema: receiptSchema,
        name: "receipt",
        description: "Expense receipt fields for a bus fleet ledger",
      }),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: [
                "Read this Indian bus-fleet expense receipt.",
                "amount is the total in rupees.",
                "date is the receipt date as YYYY-MM-DD.",
                "category is Diesel for fuel, Toll for tolls, Maintenance for repairs or service, Batta for crew allowance, and Other otherwise.",
                "liters is the fuel volume when the receipt shows it, otherwise null.",
                "vendorName is the pump or shop name when it is visible, otherwise null.",
              ].join(" "),
            },
            {
              type: "file",
              mediaType: image.mediaType,
              data: { type: "data", data: image.base64 },
            },
          ],
        },
      ],
    });

    return NextResponse.json(result.output);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not read that receipt.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

function readImage(
  body: unknown,
): { base64: string; mediaType: string } | null {
  if (!body || typeof body !== "object") {
    return null;
  }
  const image = "image" in body ? body.image : undefined;
  const mediaType = "mediaType" in body ? body.mediaType : undefined;
  if (typeof image !== "string" || image.trim() === "") {
    return null;
  }
  const type =
    typeof mediaType === "string" && mediaType.startsWith("image/")
      ? mediaType
      : "image/jpeg";
  return { base64: image.trim(), mediaType: type };
}
