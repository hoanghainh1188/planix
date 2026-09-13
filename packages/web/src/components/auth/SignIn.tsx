import { useState, type FormEvent, type JSX } from 'react';
import './auth.css';

export interface SignInProps {
  readonly onSignedIn: () => void;
}

export function SignIn({ onSignedIn }: SignInProps): JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        onSignedIn();
        return;
      }
      // 429 nói "thử lại sau", 401 nói "sai thông tin". Gộp hai thứ lại sẽ khiến người
      // dùng gõ lại mật khẩu đúng nhiều lần mà không hiểu vì sao vẫn hỏng.
      setError(
        res.status === 429
          ? 'Too many attempts. Try again in 15 minutes.'
          : 'Email or password is incorrect.',
      );
    } catch {
      setError('Cannot reach the server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="signin">
      <form className="signin__card" onSubmit={(e) => void submit(e)}>
        <div className="signin__brand">
          <span className="signin__mark">planix</span>
          <span className="signin__tag">WBS</span>
        </div>

        <label className="signin__field">
          <span className="signin__label">Email</span>
          <input
            className="signin__input"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>

        <label className="signin__field">
          <span className="signin__label">Password</span>
          <input
            className="signin__input"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        <button className="signin__submit" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        {error === null ? null : (
          <p className="signin__error" role="alert">
            {error}
          </p>
        )}

        <p className="signin__note">
          Accounts are created by an administrator. There is no public sign-up.
        </p>
      </form>
    </main>
  );
}
