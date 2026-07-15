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
      monthlyBudgetUsd: settings.monthlyBudgetUsd,
      leadRecoveryEnabled: settings.leadRecoveryEnabled,
      leadRecoveryFirstMessageHours: settings.leadRecoveryFirstMessageHours,
      leadRecoverySecondMessageHours: settings.leadRecoverySecondMessageHours,
      leadRecoveryBusinessHourStart: settings.leadRecoveryBusinessHourStart,
      leadRecoveryBusinessHourEnd: settings.leadRecoveryBusinessHourEnd,
      leadRecoveryTimezone: settings.leadRecoveryTimezone,
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
      monthlyBudgetUsd?: number | null;
      leadRecoveryEnabled?: boolean;
      leadRecoveryFirstMessageHours?: number;
      leadRecoverySecondMessageHours?: number | null;
      leadRecoveryBusinessHourStart?: number;
      leadRecoveryBusinessHourEnd?: number;
      leadRecoveryTimezone?: string;
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
    if (body.monthlyBudgetUsd !== undefined) {
      data.monthlyBudgetUsd = body.monthlyBudgetUsd === null || Number.isNaN(body.monthlyBudgetUsd)
        ? null
        : Math.max(0, body.monthlyBudgetUsd);
      data.budgetAlertMonth = null;
    }

    if (body.leadRecoveryEnabled !== undefined) data.leadRecoveryEnabled = body.leadRecoveryEnabled;
    if (body.leadRecoveryFirstMessageHours !== undefined) {
      data.leadRecoveryFirstMessageHours = Math.max(1, Math.round(body.leadRecoveryFirstMessageHours));
    }
    if (body.leadRecoverySecondMessageHours !== undefined) {
      data.leadRecoverySecondMessageHours =
        body.leadRecoverySecondMessageHours === null || Number.isNaN(body.leadRecoverySecondMessageHours)
          ? null
          : Math.max(1, Math.round(body.leadRecoverySecondMessageHours));
    }
    if (body.leadRecoveryBusinessHourStart !== undefined) {
      data.leadRecoveryBusinessHourStart = Math.min(23, Math.max(0, Math.round(body.leadRecoveryBusinessHourStart)));
    }
    if (body.leadRecoveryBusinessHourEnd !== undefined) {
      data.leadRecoveryBusinessHourEnd = Math.min(24, Math.max(1, Math.round(body.leadRecoveryBusinessHourEnd)));
    }
    if (body.leadRecoveryTimezone) data.leadRecoveryTimezone = body.leadRecoveryTimezone;

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
      monthlyBudgetUsd: settings.monthlyBudgetUsd,
      leadRecoveryEnabled: settings.leadRecoveryEnabled,
      leadRecoveryFirstMessageHours: settings.leadRecoveryFirstMessageHours,
      leadRecoverySecondMessageHours: settings.leadRecoverySecondMessageHours,
      leadRecoveryBusinessHourStart: settings.leadRecoveryBusinessHourStart,
      leadRecoveryBusinessHourEnd: settings.leadRecoveryBusinessHourEnd,
      leadRecoveryTimezone: settings.leadRecoveryTimezone,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
