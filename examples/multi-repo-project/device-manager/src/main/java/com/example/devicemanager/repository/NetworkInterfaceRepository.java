package com.example.devicemanager.repository;

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
}
