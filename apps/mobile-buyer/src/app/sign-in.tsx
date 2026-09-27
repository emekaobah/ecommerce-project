import { SignInScreen } from '@/screens/sign-in/sign-in-screen';

// Presented as a modal so a guest returns to where they were (ADR 0001).
export default function SignInRoute() {
  return <SignInScreen />;
}
