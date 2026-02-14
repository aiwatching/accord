package com.example.devicemanager.repository;

import com.example.devicemanager.model.InterfaceStatus;
import com.example.devicemanager.model.InterfaceType;
import com.example.devicemanager.model.NetworkInterface;

import java.util.List;
import java.util.Optional;

public interface NetworkInterfaceRepository {
    List<NetworkInterface> findAll();
    List<NetworkInterface> findByDeviceId(String deviceId);
    Optional<NetworkInterface> findById(String id);
    Optional<NetworkInterface> findByIdAndDeviceId(String id, String deviceId);
    NetworkInterface save(NetworkInterface networkInterface);
    void deleteById(String id);
    boolean existsById(String id);
    boolean existsByIdAndDeviceId(String id, String deviceId);

    // New methods for filtering and pagination
    List<NetworkInterface> findAllWithFilters(String deviceId, InterfaceType type,
                                               InterfaceStatus status, Boolean enabled);
    long countWithFilters(String deviceId, InterfaceType type,
                         InterfaceStatus status, Boolean enabled);

    // Batch operations
    List<NetworkInterface> findByIds(List<String> ids);
    void deleteByIds(List<String> ids);
}
