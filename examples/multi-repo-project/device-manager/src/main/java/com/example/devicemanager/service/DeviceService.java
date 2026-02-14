package com.example.devicemanager.service;

import com.example.devicemanager.dto.BatchDeleteResponse;
import com.example.devicemanager.model.Device;
import com.example.devicemanager.model.DeviceStatus;

import java.util.List;
import java.util.Optional;

public interface DeviceService {

    List<Device> listDevices(DeviceStatus status);

    Optional<Device> getDevice(String id);

    Device createDevice(Device device);

    BatchDeleteResponse batchDeleteDevices(List<String> deviceIds);

    // TODO: Pending req-002-reboot-device approval
    // Map<String, String> rebootDevice(String id);
}
