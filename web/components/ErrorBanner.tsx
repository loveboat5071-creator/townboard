'use client';

interface Props {
  error: string;
  onDismiss: () => void;
  onRetry?: () => void;
  debugInfo?: string;
}

export default function ErrorBanner({ error, onDismiss, onRetry, debugInfo }: Props) {
  const isValidationError = error.includes('입력') || error.includes('선택해주세요');

  return (
    <div style={{
      marginTop: 12, padding: '12px 14px',
      background: 'rgba(239,68,68,0.08)', borderRadius: 10,
      border: '1px solid rgba(239,68,68,0.15)',
      color: 'var(--danger)', fontSize: 13,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: debugInfo ? 8 : 0 }}>
        <span style={{ flex: 1, fontWeight: 500 }}>{error}</span>
        {!isValidationError && onRetry && (
          <button
            type="button"
            onClick={onRetry}
            style={{
              padding: '4px 10px', borderRadius: 6,
              border: '1px solid var(--danger)', background: 'transparent',
              color: 'var(--danger)', fontSize: 11, cursor: 'pointer',
              whiteSpace: 'nowrap', fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.02em'
            }}
          >
            다시 시도
          </button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          style={{
            padding: '2px 4px', borderRadius: 4,
            border: 'none', background: 'transparent',
            color: 'var(--danger)', fontSize: 16, cursor: 'pointer', lineHeight: 1,
            opacity: 0.6
          }}
          aria-label="닫기"
        >
          ×
        </button>
      </div>
      
      {debugInfo && (
        <div style={{ 
          marginTop: 8, padding: '8px 10px', 
          background: 'rgba(0,0,0,0.04)', borderRadius: 6,
          fontSize: '11px', color: '#666', borderLeft: '3px solid var(--danger)'
        }}>
          <strong>🔍 서버 진단 정보:</strong> {debugInfo}
          <div style={{ marginTop: 2, opacity: 0.8 }}>(0건일 경우 Vercel Blob 연동 확인 필요)</div>
        </div>
      )}
    </div>
  );
}
