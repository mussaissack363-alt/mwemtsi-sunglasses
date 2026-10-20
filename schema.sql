-- Enable uuid extension
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Create categories table
CREATE TABLE IF NOT EXISTS public.categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

INSERT INTO public.categories (id, name) VALUES 
  ('men', 'Men'),
  ('women', 'Women')
ON CONFLICT (id) DO NOTHING;

-- Create products table
CREATE TABLE IF NOT EXISTS public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT REFERENCES public.categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  price_tzs NUMERIC NOT NULL DEFAULT 0,
  image_url TEXT,
  position INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS products_category_idx ON public.products(category);
CREATE INDEX IF NOT EXISTS products_position_idx ON public.products(position);

-- Enable Row Level Security
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

-- Create policies for public read access
DROP POLICY IF EXISTS "Allow public read access to categories" ON public.categories;
CREATE POLICY "Allow public read access to categories" ON public.categories
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow public read access to products" ON public.products;
CREATE POLICY "Allow public read access to products" ON public.products
  FOR SELECT USING (true);

-- Create policy for insert/update/delete
DROP POLICY IF EXISTS "Allow all operations for products" ON public.products;
CREATE POLICY "Allow all operations for products" ON public.products
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all operations for categories" ON public.categories;
CREATE POLICY "Allow all operations for categories" ON public.categories
  FOR ALL USING (true) WITH CHECK (true);
