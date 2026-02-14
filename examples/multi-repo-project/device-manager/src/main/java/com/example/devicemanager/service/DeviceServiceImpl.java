package com.example.devicemanager.service;

import com.example.devicemanager.dto.BatchDeleteResponse;
import com.example.devicemanager.dto.BatchDeleteResponse.BatchDeleteError;
import com.example.devicemanager.model.Device;
import com.example.devicemanager.model.DeviceStatus;
import com.example.devicemanager.repository.DeviceRepository;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Service
public class DeviceServiceImpl implements DeviceService {

    private final DeviceRepository deviceRepository;

    public DeviceServiceImpl(DeviceRepository deviceRepository) {
        this.deviceRepository = deviceRepository;
    }

    @Override
    public List<Device> listDevices(DeviceStatus status) {
        if (status != null) {
            return deviceRepository.findByStatus(status);
        }
        return deviceRepository.findAll();
    }

    @Override
    public Optional<Device> getDevice(String id) {
        return deviceRepository.findById(id);
    }

    @Override
    public Device createDevice(Device device) {
        device.setId(UUID.randomUUID().toString());
        if (device.getStatus() == null) {
            device.setStatus(DeviceStatus.UNKNOWN);
        }
        return deviceRepository.save(device);
    }

    @Override
    public BatchDeleteResponse batchDeleteDevices(List<String> deviceIds) {
        BatchDeleteResponse response = new BatchDeleteResponse();
        List<String> deleted = new ArrayList<>();
        List<BatchDeleteError> failed = new ArrayList<>();

        for (String deviceId : deviceIds) {
            try {
                if (deviceRepository.existsById(deviceId)) {
                    deviceRepository.deleteById(deviceId);
                    deleted.add(deviceId);
                } else {
                    failed.add(new BatchDeleteError(deviceId, "Device not found"));
                }
            } catch (Exception e) {
                failed.add(new BatchDeleteError(deviceId, "Error deleting device: " + e.getMessage()));
            }
        }

        response.setDeleted(deleted);
        response.setFailed(failed);
        response.setTotalRequested(deviceIds.size());
        response.setTotalDeleted(deleted.size());
        response.setSuccess(failed.isEmpty());

        return response;
    }
}
