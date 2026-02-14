package com.example.devicemanager.controller;

import com.example.devicemanager.dto.CreateInterfaceRequest;
import com.example.devicemanager.dto.UpdateInterfaceRequest;
import com.example.devicemanager.model.NetworkInterface;
import com.example.devicemanager.service.NetworkInterfaceService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/devices/{deviceId}/interfaces")
public class NetworkInterfaceController {

    private final NetworkInterfaceService interfaceService;

    public NetworkInterfaceController(NetworkInterfaceService interfaceService) {
        this.interfaceService = interfaceService;
    }

    @GetMapping
    public List<NetworkInterface> listInterfaces(@PathVariable String deviceId) {
        return interfaceService.listInterfacesByDevice(deviceId);
    }

    @GetMapping("/{interfaceId}")
    public ResponseEntity<NetworkInterface> getInterface(
            @PathVariable String deviceId,
            @PathVariable String interfaceId) {
        return interfaceService.getInterface(deviceId, interfaceId)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping
    public ResponseEntity<NetworkInterface> createInterface(
            @PathVariable String deviceId,
            @RequestBody CreateInterfaceRequest request) {
        try {
            NetworkInterface created = interfaceService.createInterface(deviceId, request);
            return ResponseEntity.status(HttpStatus.CREATED).body(created);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().build();
        }
    }

    @PutMapping("/{interfaceId}")
    public ResponseEntity<NetworkInterface> updateInterface(
            @PathVariable String deviceId,
            @PathVariable String interfaceId,
            @RequestBody UpdateInterfaceRequest request) {
        try {
            return interfaceService.updateInterface(deviceId, interfaceId, request)
                    .map(ResponseEntity::ok)
                    .orElse(ResponseEntity.notFound().build());
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().build();
        }
    }

    @DeleteMapping("/{interfaceId}")
    public ResponseEntity<Void> deleteInterface(
            @PathVariable String deviceId,
            @PathVariable String interfaceId) {
        boolean deleted = interfaceService.deleteInterface(deviceId, interfaceId);
        return deleted ? ResponseEntity.noContent().build() : ResponseEntity.notFound().build();
    }
}
