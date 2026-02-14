package com.example.devicemanager.repository;

import com.example.devicemanager.model.Device;
import com.example.devicemanager.model.DeviceStatus;

import java.util.List;
import java.util.Optional;

public interface DeviceRepository {

    List<Device> findAll();

    List<Device> findByStatus(DeviceStatus status);

    Optional<Device> findById(String id);

    Device save(Device device);

    void deleteById(String id);

    boolean existsById(String id);
}
