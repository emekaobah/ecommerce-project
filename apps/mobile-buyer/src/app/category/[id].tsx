import { useLocalSearchParams } from 'expo-router';

import { CategoryScreen } from '@/screens/category/category-screen';

export default function CategoryRoute() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  return <CategoryScreen categoryId={id} name={name} />;
}
