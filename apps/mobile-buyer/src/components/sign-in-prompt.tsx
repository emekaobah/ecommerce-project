import { EmptyState } from '@oja/ui';
import { router } from 'expo-router';

/**
 * What a guest sees in place of signed-in-only content: the pattern emblem, what signing in
 * gives them, and the way into the sign-in modal.
 */
export function SignInPrompt({ title, message }: Readonly<{ title: string; message: string }>) {
  return <EmptyState icon="user" title={title} body={message} action={{ label: 'Sign in', onPress: () => router.push('/sign-in') }} />;
}
