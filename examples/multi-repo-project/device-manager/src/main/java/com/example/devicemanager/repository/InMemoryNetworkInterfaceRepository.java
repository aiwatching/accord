package com.example.devicemanager.repository;

import com.example.devicemanager.model.InterfaceStatus;
import com.example.devicemanager.model.InterfaceType;
import com.example.devicemanager.model.NetworkInterface;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;
import java.util.stream.Stream;

@Repository
public class InMemoryNetworkInterfaceRepository implements NetworkInterfaceRepository {

    private final Map<String, NetworkInterface> interfaces = new ConcurrentHashMap<>();

    @Override
    public List<NetworkInterface> findAll() {
        return List.copyOf(interfaces.values());
    }

    @Override
    public List<NetworkInterface> findByDeviceId(String deviceId) {
        return interfaces.values().stream()
                .filter(iface -> iface.getDeviceId().equals(deviceId))
                .collect(Collectors.toList());
    }

    @Override
    public Optional<NetworkInterface> findById(String id) {
        return Optional.ofNullable(interfaces.get(id));
    }

    @Override
    public Optional<NetworkInterface> findByIdAndDeviceId(String id, String deviceId) {
        return Optional.ofNullable(interfaces.get(id))
                .filter(iface -> iface.getDeviceId().equals(deviceId));
    }

    @Override
    public NetworkInterface save(NetworkInterface networkInterface) {
        interfaces.put(networkInterface.getId(), networkInterface);
        return networkInterface;
    }

    @Override
    public void deleteById(String id) {
        interfaces.remove(id);
    }

    @Override
    public boolean existsById(String id) {
        return interfaces.containsKey(id);
    }

    @Override
    public boolean existsByIdAndDeviceId(String id, String deviceId) {
        return Optional.ofNullable(interfaces.get(id))
                .map(iface -> iface.getDeviceId().equals(deviceId))
                .orElse(false);
    }

    @Override
    public List<NetworkInterface> findAllWithFilters(String deviceId, InterfaceType type,
                                                      InterfaceStatus status, Boolean enabled) {
        Stream<NetworkInterface> stream = interfaces.values().stream();

        if (deviceId != null && !deviceId.trim().isEmpty()) {
            stream = stream.filter(iface -> iface.getDeviceId().equals(deviceId));
        }
        if (type != null) {
            stream = stream.filter(iface -> iface.getType() == type);
        }
        if (status != null) {
            stream = stream.filter(iface -> iface.getStatus() == status);
        }
        if (enabled != null) {
            stream = stream.filter(iface -> enabled.equals(iface.getEnabled()));
        }

        return stream.collect(Collectors.toList());
    }

    @Override
    public long countWithFilters(String deviceId, InterfaceType type,
                                InterfaceStatus status, Boolean enabled) {
        return findAllWithFilters(deviceId, type, status, enabled).size();
    }
}
