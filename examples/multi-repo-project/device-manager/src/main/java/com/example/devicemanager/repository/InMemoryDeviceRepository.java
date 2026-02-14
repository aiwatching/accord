package com.example.devicemanager.repository;

import com.example.devicemanager.model.Device;
import com.example.devicemanager.model.DeviceStatus;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

@Repository
public class InMemoryDeviceRepository implements DeviceRepository {

    private final Map<String, Device> devices = new ConcurrentHashMap<>();

    @Override
    public List<Device> findAll() {
        return List.copyOf(devices.values());
    }

    @Override
    public List<Device> findByStatus(DeviceStatus status) {
        return devices.values().stream()
                .filter(device -> device.getStatus() == status)
                .collect(Collectors.toList());
    }

    @Override
    public Optional<Device> findById(String id) {
        return Optional.ofNullable(devices.get(id));
    }

    @Override
    public Device save(Device device) {
        devices.put(device.getId(), device);
        return device;
    }

    @Override
    public void deleteById(String id) {
        devices.remove(id);
    }

    @Override
    public boolean existsById(String id) {
        return devices.containsKey(id);
    }
}
