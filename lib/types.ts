export type Listing = {
  id?: number | string;
  url?: string;
  price?: number | string;
  address?: string;
  type?: string;
  number_of_bedrooms?: number;
  [key: string]: unknown;
};

export type SavedSearch = {
  id: number;
  name: string;
  url: string;
  created_at: string;
};

export type FavouriteSnapshot = Listing & { favouriteId?: number };
