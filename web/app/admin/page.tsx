'use client';

import Link from 'next/link';
import { useState, useCallback, useEffect } from 'react';

interface UploadResult {
  success: boolean;
  message: string;
  count: number;
  headers_detected?: string[];
  preview?: Record<string, unknown>[];
  storage?: string;
  enrichment?: {
    matchedRows: number;
    latLngFilled: number;
    restrictionsFilled: number;
    pricingFilled: number;
    evFilled: number;
  };
}

interface Coverage {
  count: number;
  withLatLng: number;
  withRestrictions: number;
  withPricing: number;
  withEv: number;
  industries: number;
  districts: number;
}

interface SnapshotStatus {
  storage: 'blob' | 'local';
  available: boolean;
  pathname: string;
  displayName?: string;
  access?: 'public' | 'private';
  uploadedAt?: string;
  size?: number;
  coverage?: Coverage;
  error?: string;
}

interface ActivityLogStatus {
  storage: 'blob' | 'local' | 'disabled';
  enabled: boolean;
  fileCount: number;
  totalEntries: number;
  latestTimestamp?: string;
  latestPath?: string;
  message?: string;
}

interface AdminStatusResponse {
  masterData: {
    effectiveSource: 'blob' | 'local';
    blob: SnapshotStatus;
    local: SnapshotStatus;
  };
  activityLogs: ActivityLogStatus;
  generatedAt: string;
}

export default function AdminPage() {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<AdminStatusResponse | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState('');
  const [uploadProgress, setUploadProgress] = useState('');

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    setStatusError('');
    try {
      const resp = await fetch('/api/admin/status', { cache: 'no-store' });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || '관리자 상태 조회 실패');
      setStatus(data);
    } catch (e) {
      setStatusError(String(e));
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  /** 업로드 핸들러 (포커스 스타일 정석 방식) */
  const handleUpload = useCallback(async (action: 'preview' | 'save') => {
    if (!file) { setError('파일을 선택해주세요.'); return; }
    
    if (action === 'save') setIsSaving(true);
    else setIsUploading(true);

    setError(''); 
    setResult(null);
    setUploadProgress(action === 'save' ? '데이터베이스 갱신 중...' : '파일 분석 중...');

    try {
      const formData = new FormData();
      formData.append('file', file);
      if (action === 'save') formData.append('action', 'save');

      const resp = await fetch('/api/upload', { 
        method: 'POST', 
        body: formData 
      });

      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || `서버 오류 (${resp.status})`);
      
      setResult(data);
      if (action === 'save') void loadStatus();
    } catch (e: any) {
      setError(`실패: ${e.message || String(e)}`);
    } finally {
      setIsUploading(false);
      setIsSaving(false);
      setUploadProgress('');
    }
  }, [file, loadStatus]);

  const fmt = (v: unknown) => {
    if (v == null) return '-';
    if (typeof v === 'number') return v.toLocaleString('ko-KR');
    return String(v);
  };

  const fmtDateTime = (value?: string) => {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString('ko-KR');
  };

  const fmtSize = (value?: number) => {
    if (!value) return '-';
    if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(2)} MB`;
    if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${value} B`;
  };

  const getFileName = (pathname?: string) => {
    if (!pathname) return '-';
    return pathname.split('/').pop() || pathname;
  };

  const renderCoverage = (coverage?: Coverage) => {
    if (!coverage) return null;
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginTop: 10 }}>
        {[
          { label: '총 건수', value: coverage.count },
          { label: '좌표 보유', value: coverage.withLatLng },
          { label: '영업제한 보유', value: coverage.withRestrictions },
          { label: '가격 보유', value: coverage.withPricing },
          { label: 'EV 보유', value: coverage.withEv },
          { label: '업종 수', value: coverage.industries },
        ].map((item, idx) => (
          <div key={idx} style={{ padding: '10px 12px', background: 'var(--bg-input)', borderRadius: 10 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.label}</div>
            <div style={{ fontWeight: 700 }}>{fmt(item.value)}</div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="app-container" style={{ maxWidth: 1080 }}>
      <header className="header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 onClick={() => { window.location.href = '/'; }} style={{ cursor: 'pointer' }}>⚙️ 관리자 페이지</h1>
        <span style={{ fontSize: 10, color: 'var(--text-muted)', opacity: 0.7 }}>v1.6 - Stable</span>
      </header>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="card">
          <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <span><span className="icon">🗂️</span> 현재 적용 데이터 상태</span>
            <button className="btn btn-primary" onClick={() => void loadStatus()} disabled={statusLoading}>
              {statusLoading ? '확인 중...' : '새로고침'}
            </button>
          </div>
          
          {status && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
              <div style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 12 }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>현재 적용 데이터 파일</div>
                <div style={{ fontSize: 20, fontWeight: 800 }}>
                  {status.masterData.effectiveSource === 'blob'
                    ? (status.masterData.blob.displayName || getFileName(status.masterData.blob.pathname))
                    : (status.masterData.local.displayName || getFileName(status.masterData.local.pathname))}
                </div>
                <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>최종 조회: {fmtDateTime(status.generatedAt)}</div>
              </div>

              {[status.masterData.blob, status.masterData.local].map((snapshot, i) => (
                <div key={i} style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontWeight: 700 }}>{snapshot.storage === 'blob' ? '운영 데이터 (Cloud)' : '기본 번들 (Local)'}</div>
                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: snapshot.available ? '#e6fffa' : '#fff5f5', color: snapshot.available ? '#2c7a7b' : '#c53030' }}>
                      {snapshot.available ? '연결됨' : '미연결'}
                    </span>
                  </div>
                  <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>크기: {fmtSize(snapshot.size)}</div>
                  {snapshot.error && <div style={{ fontSize: 11, color: '#c53030' }}>{snapshot.error}</div>}
                  {renderCoverage(snapshot.coverage)}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-title"><span className="icon">📤</span> 엑셀 파일 업로드</div>
          <label htmlFor="file-upload" style={{ display: 'block', padding: 30, border: '2px dashed #ddd', borderRadius: 15, textAlign: 'center', cursor: 'pointer', background: '#f9f9f9' }}>
            <div style={{ fontSize: 30 }}>📊</div>
            <div style={{ fontWeight: 600 }}>{file ? file.name : '파일을 선택하거나 드래그하세요'}</div>
            <div style={{ fontSize: 12, color: '#888' }}>.xlsx, .xls (최대 10MB)</div>
            <input id="file-upload" type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={e => setFile(e.target.files?.[0] || null)} />
          </label>
          
          <div style={{ display: 'flex', gap: 10, marginTop: 15 }}>
            <button className="btn btn-primary" onClick={() => handleUpload('preview')} disabled={!file || isUploading} style={{ flex: 1 }}>
              {isUploading ? '분석 중...' : '🔍 미리보기'}
            </button>
            <button className="btn btn-success" onClick={() => handleUpload('save')} disabled={!file || isSaving} style={{ flex: 1 }}>
              {isSaving ? '저장 중...' : '💾 DB 갱신'}
            </button>
          </div>
          
          {uploadProgress && <div style={{ marginTop: 10, textAlign: 'center', color: 'var(--accent)', fontWeight: 600 }}>⏳ {uploadProgress}</div>}
          {error && <div style={{ marginTop: 10, color: '#c53030', fontSize: 13 }}>❌ {error}</div>}
        </div>

        {result && (
          <div className="card">
            <div className="card-title">✅ {result.message}</div>
            {result.preview && (
              <div className="table-container" style={{ maxHeight: 300, overflowY: 'auto', fontSize: 12 }}>
                <table className="data-table">
                  <thead><tr><th>No</th><th>단지명</th><th>주소</th><th>구</th><th>세대수</th></tr></thead>
                  <tbody>
                    {result.preview.map((r, i) => (
                      <tr key={i}>
                        <td>{i + 1}</td>
                        <td>{fmt(r.name)}</td>
                        <td>{fmt(r.addr_road)}</td>
                        <td>{fmt(r.district)}</td>
                        <td>{fmt(r.households)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
