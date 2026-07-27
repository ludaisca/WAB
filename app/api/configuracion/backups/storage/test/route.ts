import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { getS3Config, testS3Connection, type S3StorageConfig } from "@/lib/backup/s3-storage";

interface TestBody {
  s3Endpoint?: string;
  s3Region?: string;
  s3Bucket?: string;
  s3AccessKeyId?: string;
  s3SecretAccessKey?: string;
  s3ForcePathStyle?: boolean;
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    if (session.user.role !== "admin") return NextResponse.json({ error: "No autorizado" }, { status: 403 });

    const { allowed } = await rateLimit(`backup-storage-test:${session.user.id}`, 10, 3600);
    if (!allowed) return NextResponse.json({ error: "Demasiadas solicitudes, intenta más tarde" }, { status: 429 });

    const body = (await req.json()) as TestBody;

    if (!body.s3Bucket || !body.s3AccessKeyId) {
      return NextResponse.json({ ok: false, error: "Bucket y Access Key ID son requeridos" }, { status: 400 });
    }

    // Si el secreto viene vacío (el admin no lo retecleó), probar con el ya
    // guardado — mismo espíritu que el patrón "dejar en blanco para mantener".
    let secretAccessKey = body.s3SecretAccessKey;
    if (!secretAccessKey) {
      const saved = await getS3Config();
      secretAccessKey = saved?.secretAccessKey;
    }
    if (!secretAccessKey) {
      return NextResponse.json({ ok: false, error: "Falta la Secret Access Key" }, { status: 400 });
    }

    const config: S3StorageConfig = {
      endpoint: body.s3Endpoint || null,
      region: body.s3Region || "auto",
      bucket: body.s3Bucket,
      accessKeyId: body.s3AccessKeyId,
      secretAccessKey,
      forcePathStyle: body.s3ForcePathStyle ?? false,
    };

    const result = await testS3Connection(config);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
