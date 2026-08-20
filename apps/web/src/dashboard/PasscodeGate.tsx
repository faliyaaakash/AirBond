import { useState } from 'react';
import { theme } from '../theme';
import Card from '../components/Card';
import Button from '../components/Button';

interface PasscodeGateProps {
  error: string | null;
  connecting: boolean;
  onSubmit: (code: string) => void;
}

export default function PasscodeGate({ error, connecting, onSubmit }: PasscodeGateProps) {
  const [code, setCode] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    onSubmit(code.trim());
  };

  return (
    <div style={{ maxWidth: 420, margin: '80px auto', padding: 20, fontFamily: theme.font.body }}>
      <Card>
        <h1 style={{ fontSize: 22, marginBottom: 6 }}>Live Dashboard</h1>
        <p style={{ color: theme.color.textSecondary, fontSize: 14, marginBottom: 16 }}>
          Enter the access passcode to view live traffic statistics.
        </p>
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Passcode"
            autoFocus
            style={{
              display: 'block',
              width: '100%',
              padding: '10px 14px',
              borderRadius: theme.radius.md,
              border: `1px solid ${theme.color.border}`,
              boxSizing: 'border-box',
              marginBottom: 12,
              fontFamily: theme.font.body,
            }}
          />
          <Button type="submit" disabled={connecting || !code.trim()}>
            {connecting ? 'Checking...' : 'Enter'}
          </Button>
          {error && <p style={{ color: theme.color.danger, fontSize: 13, marginTop: 10 }}>{error}</p>}
        </form>
      </Card>
    </div>
  );
}
