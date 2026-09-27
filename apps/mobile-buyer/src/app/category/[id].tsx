import { Stack, useLocalSearchParams } from 'expo-router';

import { CategoryScreen } from '@/screens/category/category-screen';

export default function CategoryRoute() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  return (
    <>
      <Stack.Screen options={{ title: name ?? '' }} />
      <CategoryScreen categoryId={id} />
    </>
  );
}
