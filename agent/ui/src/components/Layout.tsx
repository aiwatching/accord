import React from 'react';
import { NavLink } from 'react-router-dom';
import { useWebSocket } from '../hooks/useWebSocket';

const navItems = [
  { to: '/', label: 'Dashboard' },
  { to: '/services', label: 'Services' },
  { to: '/requests', label: 'Requests' },
  { to: '/workers', label: 'Workers' },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const { connected } = useWebSocket();

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {/* Sidebar */}
      <nav style={{
        width: 220,
        background: '#1e293b',
        padding: '24px 0',
        display: 'flex',
        flexDirection: 'column',
        borderRight: '1px solid #334155',
      }}>
        <div style={{ padding: '0 20px', marginBottom: 32 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#f1f5f9', margin: 0 }}>Accord Hub</h1>
          <div style={{
            fontSize: 12,
            marginTop: 6,
            color: connected ? '#4ade80' : '#f87171',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: connected ? '#4ade80' : '#f87171',
              display: 'inline-block',
            }} />
            {connected ? 'Connected' : 'Disconnected'}
          </div>
        </div>

        {navItems.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            style={({ isActive }) => ({
              display: 'block',
              padding: '10px 20px',
              color: isActive ? '#f1f5f9' : '#94a3b8',
              background: isActive ? '#334155' : 'transparent',
              textDecoration: 'none',
              fontSize: 14,
              fontWeight: isActive ? 600 : 400,
              borderLeft: isActive ? '3px solid #3b82f6' : '3px solid transparent',
            })}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* Main content */}
      <main style={{ flex: 1, padding: 32, overflow: 'auto' }}>
        {children}
      </main>
    </div>
  );
}
