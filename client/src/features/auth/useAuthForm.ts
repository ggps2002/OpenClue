import { useState, type FormEvent } from 'react';
import { ApiError } from '../../lib/ApiClient';

/** Shared submit/error state for the sign-in and sign-up forms. */
export function useAuthForm(submit: () => Promise<void>) {
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setFieldErrors({});
    try {
      await submit();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.issues.length ? null : err.message);
        setFieldErrors(Object.fromEntries(err.issues.map((i) => [i.path, i.message])));
      } else {
        setError('Could not reach the server. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return { error, fieldErrors, submitting, onSubmit };
}
