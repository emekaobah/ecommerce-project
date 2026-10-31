import type { CategoryImage } from '@oja/domain';
import { useQuery } from '@tanstack/react-query';

import { storeClient } from './client';

export const categoryKeys = {
  all: ['categories'] as const,
};

export type Category = {
  id: string;
  name: string;
  rank: number;
  parent_category_id: string | null;
  /** Its icon, thumbnail and banner, as an admin uploads them on the category's Media card. */
  media_images: CategoryImage[];
};

async function fetchCategories(): Promise<Category[]> {
  // Mercur's route leaves its response untyped. It lists only active, public categories.
  const { product_categories } = (await storeClient.store.productCategories.query({
    fields: 'id,name,rank,parent_category_id,*media_images',
    limit: 200,
  })) as { product_categories: Category[] };
  return product_categories;
}

/** Every category buyers can browse; the screen arranges them into departments. */
export function useCategories() {
  return useQuery({ queryKey: categoryKeys.all, queryFn: fetchCategories, staleTime: 5 * 60 * 1000 });
}
