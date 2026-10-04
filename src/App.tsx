import { Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from '@/components/AppLayout';
import { PolicyListScreen } from '@/screens/PolicyListScreen';
import { PolicyDetailScreen } from '@/screens/PolicyDetailScreen';
import { PolicyEditScreen } from '@/screens/PolicyEditScreen';
import { SimulatorScreen } from '@/screens/SimulatorScreen';
import { RevisionHistoryScreen } from '@/screens/RevisionHistoryScreen';
import { ImportScreen } from '@/screens/ImportScreen';
import { ExportScreen } from '@/screens/ExportScreen';
import { AuditScreen } from '@/screens/AuditScreen';
import { CatalogsScreen } from '@/screens/CatalogsScreen';
import { ConfigurationScreen } from '@/screens/ConfigurationScreen';
import { ComponentGalleryScreen } from '@/screens/ComponentGalleryScreen';

export function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/policies" replace />} />
        <Route path="policies" element={<PolicyListScreen />} />
        <Route path="policies/new" element={<PolicyEditScreen mode="create" />} />
        <Route path="policies/:guid" element={<PolicyDetailScreen />} />
        <Route path="policies/:guid/edit" element={<PolicyEditScreen mode="edit" />} />
        <Route path="policies/:guid/history" element={<RevisionHistoryScreen />} />
        <Route path="simulator" element={<SimulatorScreen />} />
        <Route path="import" element={<ImportScreen />} />
        <Route path="export" element={<ExportScreen />} />
        <Route path="audit" element={<AuditScreen />} />
        <Route path="catalogs" element={<CatalogsScreen />} />
        <Route path="scopes" element={<Navigate to="/catalogs" replace />} />
        <Route path="configuration" element={<ConfigurationScreen />} />
        <Route path="gallery" element={<ComponentGalleryScreen />} />
        <Route path="*" element={<Navigate to="/policies" replace />} />
      </Route>
    </Routes>
  );
}
