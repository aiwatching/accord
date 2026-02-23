import React, { useState, useCallback } from 'react';
import { Layout, type TabId } from './components/Layout';
import { Console } from './pages/Console';
import { Analytics } from './pages/Analytics';

export function App() {
  const [activeTab, setActiveTab] = useState<TabId>('console');

  const navigateToRequests = useCallback(() => setActiveTab('requests'), []);

  return (
    <Layout activeTab={activeTab} onTabChange={setActiveTab}>
      {activeTab === 'console' && <Console onViewHistory={navigateToRequests} />}
      {activeTab === 'requests' && <Console renderRequestsPage onViewHistory={navigateToRequests} />}
      {activeTab === 'analytics' && <Analytics />}
    </Layout>
  );
}
