import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/crypto";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    if (session.user.role !== "admin") return NextResponse.json({ error: "No autorizado" }, { status: 403 });

    let config = await prisma.systemConfig.findUnique({ where: { id: "default" } });
    if (!config) {
      config = await prisma.systemConfig.create({ data: { id: "default" } });
    }

    return NextResponse.json({
      s3Enabled: config.s3Enabled,
      s3Endpoint: config.s3Endpoint,
      s3Region: config.s3Region,
      s3Bucket: config.s3Bucket,
      s3AccessKeyId: config.s3AccessKeyId,
      s3SecretAccessKey: config.s3SecretAccessKey ? "••••••••" : null,
      s3ForcePathStyle: config.s3ForcePathStyle,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    if (session.user.role !== "admin") return NextResponse.json({ error: "No autorizado" }, { status: 403 });

    const body = (await req.json()) as {
      s3Enabled?: boolean;
      s3Endpoint?: string;
      s3Region?: string;
      s3Bucket?: string;
      s3AccessKeyId?: string;
      s3SecretAccessKey?: string;
      s3ForcePathStyle?: boolean;
    };

    const data: Record<string, unknown> = {};

    if (body.s3Enabled !== undefined) data.s3Enabled = body.s3Enabled;
    if (body.s3Endpoint !== undefined) data.s3Endpoint = body.s3Endpoint || null;
    if (body.s3Region !== undefined) data.s3Region = body.s3Region || null;
    if (body.s3Bucket !== undefined) data.s3Bucket = body.s3Bucket || null;
    if (body.s3AccessKeyId !== undefined) data.s3AccessKeyId = body.s3AccessKeyId || null;
    if (body.s3ForcePathStyle !== undefined) data.s3ForcePathStyle = body.s3ForcePathStyle;

    if (body.s3SecretAccessKey !== undefined) {
      data.s3SecretAccessKey = body.s3SecretAccessKey ? encrypt(body.s3SecretAccessKey) : null;
    }

    const config = await prisma.systemConfig.upsert({
      where: { id: "default" },
      create: { id: "default", ...data },
      update: data,
    });

    return NextResponse.json({
      s3Enabled: config.s3Enabled,
      s3Endpoint: config.s3Endpoint,
      s3Region: config.s3Region,
      s3Bucket: config.s3Bucket,
      s3AccessKeyId: config.s3AccessKeyId,
      s3SecretAccessKey: config.s3SecretAccessKey ? "••••••••" : null,
      s3ForcePathStyle: config.s3ForcePathStyle,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
