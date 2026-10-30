import { getStorage } from './index';

export interface ScanJobRecord {
  jobId: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  createdAt: string;
  updatedAt: string;
  result?: any;
  error?: string;
}

export async function createScanJob(jobId: string): Promise<ScanJobRecord> {
  const store = getStorage();
  const job: ScanJobRecord = {
    jobId,
    status: 'PENDING',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await store.set(`job:${jobId}`, job, { exSeconds: 3600 });
  return job;
}

export async function updateScanJob(
  jobId: string,
  updates: Partial<ScanJobRecord>
): Promise<ScanJobRecord | null> {
  const store = getStorage();
  const current = await store.get<ScanJobRecord>(`job:${jobId}`);
  if (!current) return null;
  const updated: ScanJobRecord = {
    ...current,
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  await store.set(`job:${jobId}`, updated, { exSeconds: 3600 });
  return updated;
}

export async function getScanJob(jobId: string): Promise<ScanJobRecord | null> {
  const store = getStorage();
  return await store.get<ScanJobRecord>(`job:${jobId}`);
}
