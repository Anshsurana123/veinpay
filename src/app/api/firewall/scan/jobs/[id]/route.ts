import { NextRequest, NextResponse } from 'next/server';
import { getScanJob } from '@/lib/storage/jobs';

export const maxDuration = 30;

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: 'Job ID required' }, { status: 400 });
  }

  const job = await getScanJob(id);
  if (!job) {
    return NextResponse.json(
      { error: 'JOB_NOT_FOUND', message: `Job ${id} not found.` },
      { status: 404 }
    );
  }

  return NextResponse.json(job, { status: 200 });
}
