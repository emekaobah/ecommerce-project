import { AddressPrompt } from '@/components/address-prompt';
import { HomeScreen } from '@/screens/home/home-screen';

/** Home, with "Where should we deliver?" over it for a signed-in buyer with no saved address. */
export default function HomeRoute() {
  return (
    <>
      <HomeScreen />
      <AddressPrompt />
    </>
  );
}
