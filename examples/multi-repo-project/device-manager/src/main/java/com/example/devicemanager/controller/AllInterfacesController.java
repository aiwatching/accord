package com.example.devicemanager.controller;

import com.example.devicemanager.dto.AllInterfacesResponse;
import com.example.devicemanager.model.InterfaceStatus;
import com.example.devicemanager.model.InterfaceType;
import com.example.devicemanager.service.NetworkInterfaceService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/interfaces")
public class AllInterfacesController {

    private final NetworkInterfaceService interfaceService;

    public AllInterfacesController(NetworkInterfaceService interfaceService) {
        this.interfaceService = interfaceService;
    }

    @GetMapping
    public ResponseEntity<AllInterfacesResponse> getAllInterfaces(
            @RequestParam(required = false) String deviceId,
            @RequestParam(required = false) InterfaceType type,
            @RequestParam(required = false) InterfaceStatus status,
            @RequestParam(required = false) Boolean enabled,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "50") int pageSize) {

        try {
            AllInterfacesResponse response = interfaceService.listAllInterfaces(
                    deviceId, type, status, enabled, page, pageSize);
            return ResponseEntity.ok(response);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().build();
        }
    }
}
