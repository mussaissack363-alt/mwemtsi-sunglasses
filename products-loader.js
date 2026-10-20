(function() {
  const SUPABASE_URL = 'https://bjjyotduxvcwcuaztxgj.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_dVi5KufBJGYDM6slTAz0Hw_VN4XsRTq';
  
  let supabase = null;
  if (typeof window !== 'undefined') {
    if (window.supabase && typeof window.supabase.createClient === 'function') {
      supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    } else if (window.mwemtsiSupabase) {
      supabase = window.mwemtsiSupabase;
    }
  }
  
  async function loadProducts(category) {
    if (!supabase) return null;
    try {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('category', category)
        .eq('active', true)
        .order('position', { ascending: true });
      if (error) throw error;
      return data || [];
    } catch (e) {
      console.error('Error loading products:', e);
      return null;
    }
  }
  
  async function saveProduct(product) {
    if (!supabase) return false;
    try {
      const { error } = await supabase
        .from('products')
        .update({
          name: product.name,
          price_tzs: product.price_tzs,
          image_url: product.image_url,
          updated_at: new Date().toISOString()
        })
        .eq('id', product.id);
      if (error) throw error;
      return true;
    } catch (e) {
      console.error('Error saving product:', e);
      return false;
    }
  }
  
  window.mwemtsiProducts = {
    loadProducts,
    saveProduct,
    supabase
  };
})();
