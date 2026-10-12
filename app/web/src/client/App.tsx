import { useEffect } from 'react';
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useSettings } from './api';
import { ErrorBoundary } from './components/ErrorBoundary';
import { CurrencyContext } from './components/ui';
import { ActivityPage } from './pages/Activity';
import { ClearancePage } from './pages/Clearance';
import { ClearanceNewPage } from './pages/ClearanceNew';
import { DashboardPage } from './pages/Dashboard';
import { PlanDetailPage } from './pages/PlanDetail';
import { PlansPage } from './pages/Plans';
import { ProductDetailPage } from './pages/ProductDetail';
import { ProductsPage } from './pages/Products';
import { SettingsPage } from './pages/Settings';
import { SuppliersPage } from './pages/Suppliers';

export function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: settings } = useSettings();

  // App Bridge nav (and Polaris links) emit `shopify:navigate`; route client-side instead of reloading.
  useEffect(() => {
    const onNavigate = (e: Event) => {
      const href = (e.target as HTMLElement | null)?.getAttribute?.('href');
      if (href) navigate(href);
    };
    document.addEventListener('shopify:navigate', onNavigate);
    return () => document.removeEventListener('shopify:navigate', onNavigate);
  }, [navigate]);

  // Braces matter: in the admin, scrollTo isn't guaranteed to return undefined,
  // and React would treat a returned value as an effect cleanup function.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <CurrencyContext.Provider value={settings?.currency ?? 'USD'}>
      <s-app-nav>
        {/* rel="home" marks the app root for App Bridge; not in the Polaris link typings. */}
        <s-link href="/" {...{ rel: 'home' }}>
          Dashboard
        </s-link>
        <s-link href="/products">Products</s-link>
        <s-link href="/plans">Restock plans</s-link>
        <s-link href="/clearance">Clearance</s-link>
        <s-link href="/suppliers">Suppliers</s-link>
        <s-link href="/activity">Activity</s-link>
        <s-link href="/settings">Settings</s-link>
      </s-app-nav>
      <ErrorBoundary resetKey={location.pathname}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/products" element={<ProductsPage />} />
          <Route path="/products/:id" element={<ProductDetailPage />} />
          <Route path="/plans" element={<PlansPage />} />
          <Route path="/plans/:id" element={<PlanDetailPage />} />
          <Route path="/clearance" element={<ClearancePage />} />
          <Route path="/clearance/new" element={<ClearanceNewPage />} />
          <Route path="/suppliers" element={<SuppliersPage />} />
          <Route path="/activity" element={<ActivityPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<DashboardPage />} />
        </Routes>
      </ErrorBoundary>
    </CurrencyContext.Provider>
  );
}
