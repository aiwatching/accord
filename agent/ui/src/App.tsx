import React, { useState } from 'react';
import { Layout, type TabId } from './components/Layout';
import { Console } from './pages/Console';
import { Analytics } from './pages/Analytics';

export function App() {
  const [activeTab, setActiveTab] = useState<TabId>('console');

  return (
    <Layout activeTab={activeTab} onTabChange={setActiveTab}>
      {activeTab === 'console' ? <Console /> : <Analytics />}
    </Layout>
  );
}
