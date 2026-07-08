import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/crypto";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    let settings = await prisma.appSettings.findUnique({
      where: { userId: session.user.id },
    });

    if (!settings) {
      settings = await prisma.appSettings.create({
        data: { userId: session.user.id },
      });
    }

    return NextResponse.json({
      id: settings.id,
      openrouterApiKey: settings.openrouterApiKey ? "••••••••" : null,
      googleApiKey: settings.googleApiKey ? "••••••••" : null,
      defaultProvider: settings.defaultProvider,
      defaultModel: settings.defaultModel,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const body = (await req.json()) as {
      openrouterApiKey?: string;
      googleApiKey?: string;
      defaultProvider?: string;
      defaultModel?: string;
    };

    const data: Record<string, unknown> = {};

    if (body.openrouterApiKey !== undefined) {
      if (body.openrouterApiKey) {
        data.openrouterApiKey = encrypt(body.openrouterApiKey);
      } else {
        data.openrouterApiKey = null;
      }
    }

    if (body.googleApiKey !== undefined) {
      if (body.googleApiKey) {
        data.googleApiKey = encrypt(body.googleApiKey);
      } else {
        data.googleApiKey = null;
      }
    }

    if (body.defaultProvider) data.defaultProvider = body.defaultProvider;
    if (body.defaultModel) data.defaultModel = body.defaultModel;

    const settings = await prisma.appSettings.upsert({
      where: { userId: session.user.id },
      create: { userId: session.user.id, ...data },
      update: data,
    });

    return NextResponse.json({
      id: settings.id,
      openrouterApiKey: settings.openrouterApiKey ? "••••••••" : null,
      googleApiKey: settings.googleApiKey ? "••••••••" : null,
      defaultProvider: settings.defaultProvider,
      defaultModel: settings.defaultModel,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
