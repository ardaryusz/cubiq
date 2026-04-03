import { useEffect } from 'react';
import { useAppStore } from './store';
import Sidebar from './components/Sidebar/Sidebar';
import ChatArea from './components/Chat/ChatArea';
import SettingsModal from './components/Settings/SettingsModal';
import styles from './App.module.css';

function App() {
  const initialize = useAppStore(state => state.initialize);
  const isLoading = useAppStore(state => state.isLoading);
  const isSettingsOpen = useAppStore(state => state.isSettingsOpen);

  useEffect(() => {
    initialize();
  }, [initialize]);

  if (isLoading) {
    return <div className={styles.loading}>Loading Cubiq...</div>;
  }

  return (
    <div className={styles.appContainer}>
      <Sidebar />
      <main className={styles.mainContent}>
        <ChatArea />
      </main>
      {isSettingsOpen && <SettingsModal />}
    </div>
  );
}

export default App;
