import { useEffect, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import Layout from './components/Layout';
import { ToastHost } from './components/ui';
import LibraryPage from './pages/LibraryPage';
import MangaPage from './pages/MangaPage';
import ReaderPage from './pages/ReaderPage';
import DownloadsPage from './pages/DownloadsPage';
import UpdatesPage from './pages/UpdatesPage';
import BrowsePage from './pages/BrowsePage';
import SourcePage from './pages/SourcePage';
import SettingsPage from './pages/SettingsPage';
import FindPage from './pages/FindPage';
import DuplicatesPage from './pages/DuplicatesPage';
import OfflinePage from './pages/OfflinePage';
import AniListCallbackPage from './pages/AniListCallbackPage';
import LoginDialog from './components/LoginDialog';
import { UNAUTHORIZED_EVENT } from './api/client';

export default function App() {
  const [needLogin, setNeedLogin] = useState(false);
  const qc = useQueryClient();

  useEffect(() => {
    const h = () => setNeedLogin(true);
    window.addEventListener(UNAUTHORIZED_EVENT, h);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, h);
  }, []);

  return (
    <>
      <Routes>
        <Route path="/read/:mangaId/:chapterId" element={<ReaderPage />} />
        <Route element={<Layout />}>
          <Route index element={<LibraryPage />} />
          <Route path="manga/:id" element={<MangaPage />} />
          <Route path="updates" element={<UpdatesPage />} />
          <Route path="downloads" element={<DownloadsPage />} />
          <Route path="find" element={<FindPage />} />
          <Route path="duplicates" element={<DuplicatesPage />} />
          <Route path="offline" element={<OfflinePage />} />
          <Route path="anilist" element={<AniListCallbackPage />} />
          <Route path="browse" element={<BrowsePage />} />
          <Route path="browse/:sourceId" element={<SourcePage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<LibraryPage />} />
        </Route>
      </Routes>
      {needLogin && (
        <LoginDialog
          onDone={() => {
            setNeedLogin(false);
            qc.invalidateQueries();
          }}
        />
      )}
      <ToastHost />
    </>
  );
}
