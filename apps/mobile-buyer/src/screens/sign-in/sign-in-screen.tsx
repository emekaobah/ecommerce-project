import { useAuth } from '@clerk/expo';
import { AuthView } from '@clerk/expo/native';
import { router } from 'expo-router';
import { useEffect } from 'react';

const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

/**
 * Clerk's native sign-in-or-up UI: Google, Apple and email, as enabled for the Clerk instance.
 * Needs a development build; the session syncs to the JS SDK on its own.
 */
export function SignInScreen() {
  // Default `useAuth` treats a session with pending tasks as signed out, so the modal stays
  // open until AuthView has finished them and the session is active.
  const { isSignedIn } = useAuth();

  useEffect(() => {
    if (isSignedIn) close();
  }, [isSignedIn]);

  return <AuthView onDismiss={close} />;
}
