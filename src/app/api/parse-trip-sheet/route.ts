import { google } from "@ai-sdk/google";
import { generateObject } from "ai";
import { NextResponse } from "next/server";
import {
  isOrganizationId,
  requireOrganizationMember,
  SessionError,
} from "@data/auth/session";
import { tripSheetPrompt, tripSheetSchema } from "@domain/trips/tripSheet";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// Trip sheets are photographed larger than receipts so handwriting stays legible.
const MAX_IMAGE_CHARS = 3_000_000;

const models = [
  "gemini-3.8-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.6-flash",
] as const;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send a trip sheet photo." }, { status: 400 });
  }

  const organizationId = readOrganizationId(body);
  if (!organizationId) {
    return NextResponse.json({ error: "Choose an organization." }, { status: 400 });
  }

  try {
    const supabase = await createServerSupabaseClient();
    await requireOrganizationMember(supabase, organizationId);
  } catch (error) {
    if (error instanceof SessionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message =
      error instanceof Error ? error.message : "Could not verify the session.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return NextResponse.json(
      { error: "Add GOOGLE_GENERATIVE_AI_API_KEY to .env.local." },
      { status: 500 },
    );
  }

  const image = readImage(body);
  if (!image) {
    return NextResponse.json({ error: "Send a trip sheet photo." }, { status: 400 });
  }
  if (image.base64.length > MAX_IMAGE_CHARS) {
    return NextResponse.json(
      { error: "That photo is too large. Try again a little closer to the sheet." },
      { status: 413 },
    );
  }

  for (const [index, modelName] of models.entries()) {
    try {
      const result = await generateObject({
        model: google(modelName),
        schema: tripSheetSchema,
        schemaName: "trip_sheet",
        schemaDescription: "Fields read from a handwritten bus trip sheet",
        maxRetries: 0,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: tripSheetPrompt },
              {
                type: "file",
                mediaType: image.mediaType,
                data: image.base64,
              },
            ],
          },
        ],
      });
      return NextResponse.json(result.object);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not read that trip sheet.";
      console.error(message);
      if (index === models.length - 1) {
        return NextResponse.json({ error: message }, { status: 502 });
      }
    }
  }

  return NextResponse.json(
    { error: "Could not read that trip sheet." },
    { status: 502 },
  );
}

function readOrganizationId(body: unknown): string | null {
  if (!body || typeof body !== "object" || !("organizationId" in body)) {
    return null;
  }
  const organizationId = body.organizationId;
  return typeof organizationId === "string" && isOrganizationId(organizationId)
    ? organizationId
    : null;
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
