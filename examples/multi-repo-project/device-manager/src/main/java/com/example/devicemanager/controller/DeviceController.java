package com.example.devicemanager.controller;

import com.example.devicemanager.dto.BatchDeleteRequest;
import com.example.devicemanager.dto.BatchDeleteResponse;
import com.example.devicemanager.model.Device;
import com.example.devicemanager.model.DeviceStatus;
import com.example.devicemanager.service.DeviceService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/devices")
public class DeviceController {

    private final DeviceService deviceService;

    public DeviceController(DeviceService deviceService) {
        this.deviceService = deviceService;
    }

    @GetMapping
    public List<Device> listDevices(
            @RequestParam(required = false) DeviceStatus status,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        List<Device> devices = deviceService.listDevices(status);
        int from = Math.min(page * size, devices.size());
        int to = Math.min(from + size, devices.size());
        return devices.subList(from, to).stream()
                .map(this::sanitizeDevice)
                .toList();
    }

    @GetMapping("/{id}")
    public ResponseEntity<Device> getDevice(@PathVariable String id) {
        return deviceService.getDevice(id)
                .map(this::sanitizeDevice)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping
    public ResponseEntity<Device> createDevice(@RequestBody Device device) {
        Device created = deviceService.createDevice(device);
        return ResponseEntity.status(HttpStatus.CREATED).body(created);
    }

    @PostMapping("/batch-delete")
    public ResponseEntity<BatchDeleteResponse> batchDeleteDevices(@RequestBody BatchDeleteRequest request) {
        if (request.getDeviceIds() == null || request.getDeviceIds().isEmpty()) {
            return ResponseEntity.badRequest().build();
        }
        BatchDeleteResponse response = deviceService.batchDeleteDevices(request.getDeviceIds());
        return ResponseEntity.ok(response);
    }

    // TODO: POST /api/devices/{id}/reboot — pending req-002-reboot-device approval

    /**
     * Sanitize device by removing password from response
     * (passwords should never be returned in API responses)
     */
    private Device sanitizeDevice(Device device) {
        if (device != null) {
            device.setAuthPassword(null);  // Never return passwords
        }
        return device;
    }
}
